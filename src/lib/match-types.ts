export type MatchResult = {
  score: number; // 0…1
  level: 'match' | 'doubt' | 'reject';
  reasons: string[];
  rule?: 'match' | 'reject';
};
