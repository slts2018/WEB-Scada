package com.webscada.server.comm.supervisor;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.webscada.server.comm.driver.IoResult;
import java.util.List;
import org.junit.jupiter.api.Test;

class SubscriptionInboxTest {
  @Test
  void fullQueueDropsTheOldestAndCountsIt() {
    SubscriptionInbox inbox = new SubscriptionInbox(2);
    IoResult first = new IoResult(true, "1", List.of(), null);
    IoResult second = new IoResult(true, "2", List.of(), null);
    IoResult third = new IoResult(true, "3", List.of(), null);
    assertEquals(0, inbox.offer(first));
    assertEquals(0, inbox.offer(second));
    assertEquals(1, inbox.offer(third));
    assertEquals(1, inbox.dropped());
    List<IoResult> left = inbox.drain();
    assertEquals(List.of("2", "3"), left.stream().map(IoResult::correlationId).toList());
  }
}
