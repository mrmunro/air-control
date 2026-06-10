import { register } from "@arizeai/phoenix-otel";
import { trace } from "@opentelemetry/api";

const tracerProvider = register({
  projectName: "air-control-test",
  url: "http://localhost:6006",
});

async function main() {
  console.log("Starting test span...");
  const tracer = trace.getTracer("manual-test");
  const span = tracer.startSpan("Test Connection Span");
  span.setAttribute("test.attribute", "Success");
  span.end();
  
  console.log("Forcing flush...");
  await tracerProvider.forceFlush();
  console.log("Flush complete. Check Phoenix for 'air-control-test' project.");
}

main().catch(console.error);
