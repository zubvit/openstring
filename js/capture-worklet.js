// Runs on the audio thread. Its only job is to hand whole blocks of microphone
// samples back to the main thread with an exact sample count attached, so onset
// times can be worked out from sample positions rather than from when a message
// happened to be delivered. Message delivery is at the mercy of the main thread;
// the sample counter is not.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samplesSeen = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const ch = input[0];
      // Copy: the underlying buffer is reused by the audio thread.
      const copy = new Float32Array(ch.length);
      copy.set(ch);
      this.port.postMessage({ samples: copy, startSample: this.samplesSeen }, [copy.buffer]);
      this.samplesSeen += ch.length;
    }
    return true;
  }
}

registerProcessor('openstring-capture', CaptureProcessor);
