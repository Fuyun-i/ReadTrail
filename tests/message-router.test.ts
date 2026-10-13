// MessageRouter 单元测试
import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../src/background/message-router';

describe('MessageRouter', () => {
  it('非对象消息返回 INVALID_MESSAGE', async () => {
    const router = new MessageRouter();
    const res = await router.route(null);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_MESSAGE');
  });

  it('缺少 type 返回 INVALID_MESSAGE', async () => {
    const router = new MessageRouter();
    const res = await router.route({ requestId: 'r1' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_MESSAGE');
  });

  it('需要 requestId 的消息缺少 requestId 时返回错误', async () => {
    const router = new MessageRouter();
    router.register('SEARCH', async () => []);
    const res = await router.route({ type: 'SEARCH', payload: { query: 'test' } });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_MESSAGE');
  });

  it('OPEN_LIBRARY 不需要 requestId', async () => {
    const router = new MessageRouter();
    router.register('OPEN_LIBRARY', async () => ({ opened: true }));
    const res = await router.route({ type: 'OPEN_LIBRARY' });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ opened: true });
  });

  it('已注册的 handler 正常执行并返回数据', async () => {
    const router = new MessageRouter();
    router.register('GET_SETTINGS', async () => ({ enabled: true }));
    const res = await router.route({ type: 'GET_SETTINGS', requestId: 'r1' });
    expect(res.ok).toBe(true);
    expect(res.requestId).toBe('r1');
    expect(res.data).toEqual({ enabled: true });
  });

  it('未知消息类型返回 INVALID_MESSAGE', async () => {
    const router = new MessageRouter();
    const res = await router.route({ type: 'UNKNOWN_TYPE', requestId: 'r1' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_MESSAGE');
  });

  it('handler 抛异常时返回错误响应，不抛出', async () => {
    const router = new MessageRouter();
    router.register('DELETE_PAGE', async () => {
      throw new Error('数据库错误');
    });
    const res = await router.route({ type: 'DELETE_PAGE', requestId: 'r1', payload: { pageId: 'p1' } });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('数据库错误');
  });

  it('payload 超过大小限制时返回错误', async () => {
    const router = new MessageRouter();
    router.register('SEARCH', async () => []);
    const hugePayload = { query: 'x'.repeat(3_000_000) };
    const res = await router.route({ type: 'SEARCH', requestId: 'r1', payload: hugePayload });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_MESSAGE');
  });
});
