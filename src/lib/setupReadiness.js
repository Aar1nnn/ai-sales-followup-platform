export function sourceReadiness(sources = [], inboundEvents = []) {
  const activeSources = sources.filter((source) => source.status === "active");
  const activeSourceIds = new Set(activeSources.map((source) => source.id));
  const successfulEvent = inboundEvents.find((event) =>
    event.status === "processed" &&
    Boolean(event.lead_id) &&
    activeSourceIds.has(event.source_connection_id)
  ) ?? null;
  const verifiedSource = successfulEvent
    ? activeSources.find((source) => source.id === successfulEvent.source_connection_id) ?? null
    : null;

  return {
    configuredSource: activeSources[0] ?? null,
    verifiedSource,
    successfulEvent,
    ready: Boolean(verifiedSource && successfulEvent),
  };
}
