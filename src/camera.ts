export interface CameraHandle {
  video: HTMLVideoElement;
  /** 實際拿到的鏡頭方向（桌機拿不到 facingMode 時視為 user） */
  facing: 'user' | 'environment';
  stop(): void;
}

export async function startCamera(
  video: HTMLVideoElement,
  facing: 'user' | 'environment',
): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  video.srcObject = stream;
  try {
    await video.play();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop()); // play 失敗時不能讓 stream 漏掉
    throw err;
  }
  const settings = stream.getVideoTracks()[0].getSettings();
  const actual = (settings.facingMode as 'user' | 'environment' | undefined) ?? 'user';
  return {
    video,
    facing: actual,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}
