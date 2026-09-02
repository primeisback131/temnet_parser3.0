package com.temnet.temnet_parser.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns exceptions into small JSON answers with a status the client can act
 * on. Without it a validation failure or a duplicate login surfaced as a bare
 * 500 and the message never reached the screen.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    /** The error body every endpoint returns. */
    public record ApiError(String message) {
    }

    /** Validation failures raised by the services. */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> badRequest(IllegalArgumentException e) {
        return reply(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<ApiError> duplicate(DuplicateKeyException e) {
        return reply(HttpStatus.CONFLICT, "Такая запись уже существует");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> integrity(DataIntegrityViolationException e) {
        log.warn("Data integrity violation", e);
        return reply(HttpStatus.CONFLICT, "Операция нарушает целостность данных");
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> forbidden(AccessDeniedException e) {
        return reply(HttpStatus.FORBIDDEN, e.getMessage() == null ? "Нет доступа" : e.getMessage());
    }

    /**
     * Everything else. Spring's own web exceptions (unknown path, missing
     * parameter, wrong method, ResponseStatusException) carry their status;
     * anything unexpected is logged with its stack and reported as 500
     * without leaking internals.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> other(Exception e) {
        if (e instanceof ErrorResponse spring) {
            String detail = spring.getBody().getDetail();
            HttpStatus status = HttpStatus.resolve(spring.getStatusCode().value());
            return reply(status == null ? HttpStatus.INTERNAL_SERVER_ERROR : status,
                    detail == null || detail.isBlank() ? status(status) : detail);
        }
        log.error("Unhandled exception", e);
        return reply(HttpStatus.INTERNAL_SERVER_ERROR, "Внутренняя ошибка сервера");
    }

    private static String status(HttpStatus status) {
        return status == null ? "Ошибка" : status.getReasonPhrase();
    }

    private static ResponseEntity<ApiError> reply(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(new ApiError(message));
    }
}
