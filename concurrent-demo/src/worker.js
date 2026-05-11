/**
 * Worker Pool - 基于Worker Threads的线程池
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorkerPool {
  constructor({ size = 4 } = {}) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.activeCount = 0;
  }

  /**
   * 执行任务
   * @param {string} taskName - 任务名称
   * @param {Function} taskFn - 任务函数（将在worker中执行）
   * @returns {Promise<any>}
   */
  run(taskName, taskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskName, taskFn, resolve, reject });
      this._processQueue();
    });
  }

  _processQueue() {
    while (this.activeCount < this.size && this.queue.length > 0) {
      const { taskName, taskFn, resolve, reject } = this.queue.shift();
      this.activeCount++;
      this._runInWorker(taskName, taskFn).then(resolve, reject).finally(() => {
        this.activeCount--;
        this._processQueue();
      });
    }
  }

  async _runInWorker(taskName, taskFn) {
    console.log(`[WorkerPool] 开始执行: ${taskName}`);

    // 简化版：直接在当前线程执行（真正的Worker Threads需要单独的worker文件）
    try {
      const result = await taskFn();
      console.log(`[WorkerPool] 完成: ${taskName}`);
      return result;
    } catch (error) {
      console.log(`[WorkerPool] 失败: ${taskName}`, error.message);
      throw error;
    }
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      capacity: this.size
    };
  }
}

/**
 * 真正的Worker Threads示例（需要单独的worker脚本）
 */
export function runInWorker(workerScript, workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, workerScript), { workerData });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}