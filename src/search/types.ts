// ===== 查询解析公共类型（architecture.md 第 9 节"后续语义接口"预留）=====

export type ParsedQuery = {
  text: string;
  from?: number;
  to?: number;
  domains?: string[];
  tags?: string[];
  /** 精确短语（引号包裹的内容，不分词） */
  phrases?: string[];
  /** 排除词（NOT 语义，前缀 - 的词） */
  excludeTerms?: string[];
  /** OR 分组：每组内的词独立召回后 union */
  orGroups?: string[][];
  confidence: number;
};
