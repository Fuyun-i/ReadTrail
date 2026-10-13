// ===== 查询解析公共类型（architecture.md 第 9 节"后续语义接口"预留）=====

export type ParsedQuery = {
  text: string;
  from?: number;
  to?: number;
  domains?: string[];
  confidence: number;
};
