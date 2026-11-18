import { FilesetResolver, ObjectDetector } from './vision_bundle.js';

let detector;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const files = await FilesetResolver.forVisionTasks('/presence/wasm', true);
      detector = await ObjectDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/presence/model.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE', scoreThreshold: 0.5, categoryAllowlist: ['person']
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'detect') {
      const canvas = new OffscreenCanvas(data.width, data.height);
      const context = canvas.getContext('2d');
      context.drawImage(data.bitmap, 0, 0, data.width, data.height);
      data.bitmap.close();
      const result = detector.detect(canvas);
      self.postMessage({ type: 'result', camera: data.camera, found: result.detections.length > 0 });
    }
  } catch {
    data.bitmap?.close();
    self.postMessage({ type: 'error' });
  }
};
