import * as THREE from 'three';

export function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Función para detectar si un punto está cerca de un segmento de línea
export function pointToSegmentDistance(point, lineStart, lineEnd) {
  const lineVec = lineEnd.clone().sub(lineStart);
  const pointVec = point.clone().sub(lineStart);
  const lineLength = lineVec.length();

  if (lineLength === 0) return pointVec.length();

  // Proyección del punto sobre la línea
  const t = Math.max(0, Math.min(1, pointVec.dot(lineVec) / (lineLength * lineLength)));
  const projection = lineStart.clone().add(lineVec.multiplyScalar(t));

  return point.distanceTo(projection);
}
