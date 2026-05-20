export function installmentSaleSplit(
  faceValue: number,
  basis: number,
  principalThisYear: number,
): { ltcg: number; basisRecovery: number } {
  if (faceValue <= 0) {
    return { ltcg: 0, basisRecovery: principalThisYear };
  }
  const gainShare = Math.max(0, (faceValue - basis) / faceValue);
  return {
    ltcg: principalThisYear * gainShare,
    basisRecovery: principalThisYear * (1 - gainShare),
  };
}
