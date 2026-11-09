// Port of modules/rtp_rtcp/include/rtp_cvo.h @ M154.

import {VideoRotation} from "../../../api/video/video-rotation.js";

// Please refer to http://www.etsi.org/deliver/etsi_ts/126100_126199/126114/
// 12.07.00_60/ts_126114v120700p.pdf Section 7.4.5. The rotation of a frame is
// the clockwise angle the frames must be rotated in order to display the frames
// correctly if the display is rotated in its natural orientation.
export function convertVideoRotationToCVOByte(rotation: VideoRotation): number {
  switch (rotation) {
    case VideoRotation.kVideoRotation_0:
      return 0;
    case VideoRotation.kVideoRotation_90:
      return 1;
    case VideoRotation.kVideoRotation_180:
      return 2;
    case VideoRotation.kVideoRotation_270:
      return 3;
  }
}

export function convertCVOByteToVideoRotation(cvoByte: number): VideoRotation {
  // CVO byte: |0 0 0 0 C F R R|.
  const rotationBits = cvoByte & 0x3;
  switch (rotationBits) {
    case 0:
      return VideoRotation.kVideoRotation_0;
    case 1:
      return VideoRotation.kVideoRotation_90;
    case 2:
      return VideoRotation.kVideoRotation_180;
    default:
      return VideoRotation.kVideoRotation_270;
  }
}
