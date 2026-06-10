import { register } from "@arizeai/phoenix-otel";
import { trace } from "@opentelemetry/api";

const tracerProvider = register({
  projectName: "air-control-test",
  url: "http://localhost:6006",
});

async function main() {
  const tracer = trace.getTracer("test-tracer");
  const span = tracer.startSpan("test-span");
  span.setAttribute("hello", "world");
  span.end();
  
  await tracerProvider.forceFlush();
  console.log("Forced flush!");
}

main().catch(console.error);
