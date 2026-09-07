package com.temnet.temnet_parser.analytics;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ParallelCallsTest {

    @Test
    void runsItemsConcurrentlyAndCountsThem() {
        AtomicInteger inFlight = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();
        ParallelCalls.Result r = ParallelCalls.run("test", List.of(1, 2, 3, 4, 5, 6), 3, item -> {
            peak.accumulateAndGet(inFlight.incrementAndGet(), Math::max);
            Thread.sleep(50);
            inFlight.decrementAndGet();
        });
        assertEquals(6, r.decided());
        assertNull(r.paused());
        assertNull(r.error());
        assertTrue(peak.get() > 1 && peak.get() <= 3, "peak concurrency " + peak.get());
    }

    @Test
    void stopsHandingOutItemsAfterAPause() {
        AtomicInteger started = new AtomicInteger();
        ParallelCalls.Result r = ParallelCalls.run("test", List.of(1, 2, 3, 4, 5, 6, 7, 8), 1, item -> {
            started.incrementAndGet();
            if (item == 2) throw new LlmUnavailableException("window full");
        });
        assertEquals(1, r.decided());
        assertEquals("window full", r.paused());
        assertEquals(2, started.get(), "nothing started after the failure");
    }
}
