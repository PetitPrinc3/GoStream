export const isGoProOnline = (gopro) => {
  if (!gopro) {
    return false;
  }
  // A GoPro is considered online if all its status fields (ctrl, strm, rcrd) are not null.
  // The backend sets these to null when the camera is not reachable.
  return gopro.ctrl !== null && gopro.strm !== null && gopro.rcrd !== null;
};
