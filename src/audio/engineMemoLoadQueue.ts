let engineLoadInFlight: Promise<void> | null = null;

export async function awaitEngineLoadIdle(): Promise<void> {
  if (engineLoadInFlight) {
    await engineLoadInFlight;
  }
}

export async function runSerializedEngineLoad(
  load: () => Promise<void>
): Promise<void> {
  const run = async (): Promise<void> => {
    await load();
  };

  const previous = engineLoadInFlight;
  const next = previous ? previous.then(run, run) : run();
  engineLoadInFlight = next;
  try {
    await next;
  } finally {
    if (engineLoadInFlight === next) {
      engineLoadInFlight = null;
    }
  }
}
