// ===== 消息路由（architecture.md 第 6 节协议要求）=====
// - 先校验 type / requestId / 字段类型与大小
// - 未知类型返回 INVALID_MESSAGE，不抛异常
// - 写入与删除保持幂等

import type { WorkerMessage, WorkerResponse } from '../shared/messages';
import { AppError, toErrorInfo } from '../shared/errors';
import { validateMessagePayload } from './message-validation';

export type MessageHandler<T = unknown> = (message: WorkerMessage) => Promise<T>;

const MAX_PAYLOAD_JSON_LENGTH = 2_000_000; // 消息体大小上限
// IMPORT_JSON 携带完整备份文件内容，跳过 payload 大小检查（消息通道本身有限制）

export class MessageRouter {
  private handlers = new Map<string, MessageHandler>();

  register(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  /** 统一入口：永不抛出，总是返回 WorkerResponse */
  async route(raw: unknown): Promise<WorkerResponse> {
    // ---- 校验阶段 ----
    if (typeof raw !== 'object' || raw === null) {
      return errorResponse('', 'INVALID_MESSAGE', '消息必须是对象');
    }
    const msg = raw as { type?: unknown; requestId?: unknown; payload?: unknown };

    if (typeof msg.type !== 'string' || msg.type.length === 0) {
      return errorResponse(asRequestId(msg.requestId), 'INVALID_MESSAGE', '缺少 type 字段');
    }

    const needsResponse = requiresResponse(msg.type);
    if (needsResponse && (typeof msg.requestId !== 'string' || msg.requestId.length === 0)) {
      return errorResponse('', 'INVALID_MESSAGE', `消息 ${msg.type} 缺少 requestId`);
    }
    const requestId = asRequestId(msg.requestId);

    // payload 大小限制（IMPORT_JSON 携带完整备份，放宽到 64MB）
    if (msg.payload !== undefined && msg.type !== 'IMPORT_JSON') {
      try {
        const json = JSON.stringify(msg.payload);
        if (json.length > MAX_PAYLOAD_JSON_LENGTH) {
          return errorResponse(requestId, 'INVALID_MESSAGE', '消息体超过大小限制');
        }
      } catch {
        return errorResponse(requestId, 'INVALID_MESSAGE', '消息体无法序列化');
      }
    }

    const handler = this.handlers.get(msg.type);
    if (!handler) {
      return errorResponse(requestId, 'INVALID_MESSAGE', `未知消息类型: ${msg.type}`);
    }

    // ---- 执行阶段 ----
    try {
      // payload 字段级运行时校验（5.3），在分发前执行
      validateMessagePayload(raw as WorkerMessage);
      const data = await handler(raw as WorkerMessage);
      return { requestId, ok: true, data };
    } catch (err) {
      const info = toErrorInfo(err);
      return { requestId, ok: false, error: info };
    }
  }
}

function requiresResponse(type: string): boolean {
  // READING_PROGRESS（内容脚本单向进度）与 OPEN_LIBRARY（popup 单向开窗）不需要 requestId
  return type !== 'READING_PROGRESS' && type !== 'OPEN_LIBRARY';
}

function asRequestId(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function errorResponse(requestId: string, code: string, message: string): WorkerResponse {
  return { requestId, ok: false, error: { code, message } };
}

export { AppError };
