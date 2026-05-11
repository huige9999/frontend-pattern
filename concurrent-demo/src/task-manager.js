/**
 * 任务管理器 - 控制并发数量，批量执行任务
 */

export class TaskManager {
  constructor({ concurrency = 4 } = {}) {
    this.concurrency = concurrency;
    this.tasks = [];
    this.running = 0;
  }

  /**
   * 添加任务
   * @param {string} name - 任务名称
   * @param {Function} fn - 异步任务函数
   * @returns {TaskManager}
   */
  addTask(name, fn) {
    this.tasks.push({ name, fn });
    return this;
  }

  /**
   * 执行所有任务（带并发控制）
   * @returns {Promise<Array>}
   */
  async executeAll() {
    const results = [];
    const executing = new Set();

    for (const task of this.tasks) {
      const promise = this._executeTask(task).then(result => {
        executing.delete(promise);
        return result;
      });

      executing.add(promise);
      results.push(promise);

      if (executing.size >= this.concurrency) {
        await Promise.race(executing);
      }
    }

    return Promise.allSettled(results);
  }

  async _executeTask(task) {
    console.log(`[TaskManager] 开始执行: ${task.name}`);
    try {
      const result = await task.fn();
      console.log(`[TaskManager] 完成: ${task.name}`);
      return { name: task.name, success: true, data: result };
    } catch (error) {
      console.log(`[TaskManager] 失败: ${task.name}`, error.message);
      return { name: task.name, success: false, error: error.message };
    }
  }

  /**
   * 清空任务列表
   */
  clear() {
    this.tasks = [];
  }
}