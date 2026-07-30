import { formatLatency, formatRate } from "@/lib/format";

const EXAMPLE_TARGET_RATE = 5_000;
const EXAMPLE_TARGET_P99_MS = 120;

export default function Home() {
  return (
    <main>
      <h1>System Design Simulator</h1>
      <p>
        Drag components onto a canvas — databases, caches, queues — set a
        target load, and watch simulated latency and throughput expose the
        bottlenecks.
      </p>
      <p>
        Example target: {formatRate(EXAMPLE_TARGET_RATE)} at{" "}
        {formatLatency(EXAMPLE_TARGET_P99_MS)} p99. The simulation engine is
        being built in <code>engine/</code>; this canvas comes next.
      </p>
    </main>
  );
}
