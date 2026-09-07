package com.temnet.temnet_parser.analytics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Runs one provider call per item on a bounded pool, so a run is not one
 * process-spawn-and-wait after another. After the first failure no further
 * item is started; whatever was not decided waits for the next run, exactly
 * as it did sequentially. {@link CallPacer} still spaces the calls when a
 * rate is set, so parallelism never exceeds the configured pace.
 */
final class ParallelCalls {

    private static final Logger log = LoggerFactory.getLogger(ParallelCalls.class);

    /** How a batch went: items decided, and why it stopped early if it did. */
    record Result(int decided, String paused, String error) {
    }

    interface Work<T> {
        void run(T item) throws Exception;
    }

    static <T> Result run(String what, List<T> items, int concurrency, Work<T> work) {
        AtomicInteger decided = new AtomicInteger();
        AtomicReference<String> paused = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        // close() waits for every submitted task, including the ones that only check the flags.
        try (ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, concurrency))) {
            for (T item : items) {
                pool.execute(() -> {
                    if (paused.get() != null || error.get() != null) {
                        return;
                    }
                    try {
                        work.run(item);
                        decided.incrementAndGet();
                    } catch (LlmUnavailableException e) {
                        if (paused.compareAndSet(null, e.getMessage())) {
                            log.info("LLM {} paused after {} calls: {}", what, decided.get(), e.getMessage());
                        }
                    } catch (Exception e) {
                        String message = e.getMessage() == null ? e.toString() : e.getMessage();
                        if (error.compareAndSet(null, message)) {
                            log.warn("LLM {} stopped after {} calls: {}", what, decided.get(), message);
                        }
                    }
                });
            }
        }
        return new Result(decided.get(), paused.get(), error.get());
    }
}
