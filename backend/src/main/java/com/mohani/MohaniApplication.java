package com.mohani;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan("com.mohani")
public class MohaniApplication {

    public static void main(String[] args) {
        SpringApplication.run(MohaniApplication.class, args);
    }
}
