package com.temnet.temnet_parser.analytics;

/**
 * The provider must not be called right now — a usage ceiling was reached,
 * the CLI is not logged in, and the like. Not an error of the call itself:
 * the classifiers log it at info level, stop the batch and retry next run.
 */
public class LlmUnavailableException extends Exception {

    public LlmUnavailableException(String message) {
        super(message);
    }
}
