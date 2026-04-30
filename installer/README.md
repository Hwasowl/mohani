# Mohani 친구 배포용 스크립트

`.bat` 파일 두 개. 친구한테 이 폴더 째로 보내거나 GitHub Releases에 zip으로 첨부.

| 파일 | 시점 | 동작 |
|---|---|---|
| `mohani-install.bat` | 한 번 / 업데이트 시 | Node 검사 + `npm install -g mohani` |
| `mohani-start.bat` | Mohani 쓸 때마다 | `mohani start` 실행 (창 유지) |

## 친구한테 보낼 안내

```
1. Node.js 20 이상 깔려있어야 함 (없으면 https://nodejs.org/ko/download)
2. mohani-install.bat 더블클릭 → 설치 메시지 보고 Enter
3. mohani-start.bat 더블클릭 → Mohani 창 뜸
4. 그 cmd 창은 닫지 말 것 (닫으면 Mohani 종료됨)
5. 업데이트 받고 싶으면 mohani-install.bat 다시 실행
```

## 왜 .exe 가 아닌 .bat?

코드 사인 안 된 .exe 는 SmartScreen 평판 검사로 매번 막힘 (마우스 spinner +
다운로드 외형). .bat 은 검사 안 함. 콘솔 창이 노출되지만 안정성 / 디버깅 용이성에서
앞섬. 친구 dogfood 단계에 충분. 추후 친구 수 늘면 electron-builder + 코드 사인.
