/**
 * Worker Thread脚本 - 在独立线程中执行任务
 * 通过parentPort与主线程通信
 */

import { parentPort, workerData } from 'worker_threads';

// 模拟CPU密集型任务
function cpuIntensiveTask(iterations) {
  let result = 0;
  for (let i = 0; i < iterations; i++) {
    result += Math.sqrt(i) * Math.sin(i);
  }
  return result;
}

// 执行任务并返回结果
async function executeTask() {
  const { taskName, iterations } = workerData;

  console.log(`[Worker] 开始执行: ${taskName}`);

  // 模拟一些异步操作
  await new Promise(resolve => setTimeout(resolve, 100));

  // 执行CPU密集型任务
  const result = cpuIntensiveTask(iterations || 1000000);

  console.log(`[Worker] 完成: ${taskName}`);

  // 发送结果回主线程
  parentPort.postMessage({
    taskName,
    result,
    threadId: process.pid
  });
}

executeTask().catch(error => {
  parentPort.postMessage({ error: error.message });
});