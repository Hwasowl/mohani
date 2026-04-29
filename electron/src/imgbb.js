// ImgBB 익명 업로드 — API key로 인증, 사용자 계정 무관.
// 응답 display_url을 채팅 메시지에 동봉. 우리 서버는 한 번도 이미지 바이트를 안 만짐.
//
// 환경변수: VITE_IMGBB_API_KEY  (electron/.env.development, .env.production 양쪽에)
// 무료 한도: 32MB/이미지. 호스트는 i.ibb.co 고정.

const IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload';
const MAX_BYTES = 32 * 1024 * 1024; // 32MB — ImgBB 한도

export class ImgBbError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

function getApiKey() {
  const key = import.meta.env.VITE_IMGBB_API_KEY;
  if (!key) {
    throw new ImgBbError(
      'ImgBB API key가 없습니다. .env에 VITE_IMGBB_API_KEY를 설정하세요.'
    );
  }
  return key;
}

export async function uploadToImgBb(blob, { onProgress } = {}) {
  if (!(blob instanceof Blob)) {
    throw new ImgBbError('Blob/File만 업로드 가능합니다.');
  }
  if (!blob.type.startsWith('image/')) {
    throw new ImgBbError('이미지 파일만 업로드할 수 있어요.');
  }
  if (blob.size > MAX_BYTES) {
    throw new ImgBbError(`이미지가 너무 커요 (최대 ${MAX_BYTES / 1024 / 1024}MB)`);
  }

  const key = getApiKey();
  const form = new FormData();
  form.append('image', blob);

  // fetch는 progress 미지원 — XHR로 onProgress 살림
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${IMGBB_ENDPOINT}?key=${encodeURIComponent(key)}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ImgBbError('네트워크 오류', { retryable: true }));
    xhr.onload = () => {
      let body;
      try { body = JSON.parse(xhr.responseText); } catch {
        return reject(new ImgBbError('ImgBB 응답 파싱 실패', { status: xhr.status }));
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.success) {
        // display_url > url > thumb 순으로 fallback. 모두 i.ibb.co 호스트.
        const link = body.data?.display_url || body.data?.url || body.data?.image?.url;
        if (!link) return reject(new ImgBbError('업로드는 됐는데 링크가 비어있어요'));
        const safe = link.replace(/^http:/, 'https:');
        resolve({ url: safe, deleteUrl: body.data?.delete_url ?? null });
      } else {
        const msg = body?.error?.message ?? body?.error ?? `ImgBB ${xhr.status}`;
        reject(new ImgBbError(typeof msg === 'string' ? msg : 'ImgBB 업로드 실패', {
          status: xhr.status,
          retryable: xhr.status >= 500,
        }));
      }
    };
    xhr.send(form);
  });
}
