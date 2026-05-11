/**
 * 多任务并发Demo - 入口文件
 * 练习Promise.all、Promise.allSettled、Worker Threads等并发模式
 */

import { TaskManager } from './src/task-manager.js';
import { WorkerPool } from './src/worker.js';

// 示例：模拟异步任务
async function fetchUser(userId) {
  await new Promise(resolve => setTimeout(resolve, 100));
  return { id: userId, name: `User ${userId}` };
}

async function fetchPosts(userId) {
  await new Promise(resolve => setTimeout(resolve, 150));
  return Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    userId,
    title: `Post ${i + 1}`
  }));
}

async function main() {
  console.log('=== 多任务并发Demo ===\n');

  // 使用TaskManager
  const manager = new TaskManager({ concurrency: 3 });

  manager.addTask('user-1', () => fetchUser(1));
  manager.addTask('user-2', () => fetchUser(2));
  manager.addTask('posts-1', () => fetchPosts(1));

  const results = await manager.executeAll();
  console.log('TaskManager结果:', results);

  console.log('\n--- 分隔线 ---\n');

  // 使用WorkerPool
  const pool = new WorkerPool({ size: 2 });

  const tasks = [
    pool.run('task-A', async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return 'Result A';
    }),
    pool.run('task-B', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'Result B';
    }),
  ];

  const poolResults = await Promise.all(tasks);
  console.log('WorkerPool结果:', poolResults);
}

main().catch(console.error);