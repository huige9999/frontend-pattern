
type Task<T> = () => Promise<T>


type TaskItem = {
  id: string;
  task: Task<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

type Snapshot = {
  concurrency: number;
  runningCount: number;
  pendingCount: number;
  runningIds: string[];
  pendingIds: string[];
}


function makeTask(ms: number):Task<any> {
  return () => new Promise((resolve) => {
    console.log(`start task ${ms}`);
    setTimeout(() => {
      console.log(`end task ${ms}`);
      resolve(ms);
    }, ms);
  })
}



export class TaskScheduler {
  private readonly concurrency: number;
  private queue: TaskItem[] = [];
  private running = new Map<string, TaskItem>();
  private nextId = 1;

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  private get runningCount() {
    return this.running.size;
  }

  private get pendingCount() {
    return this.queue.length;
  }

  private get runningIds() {
    return Array.from(this.running.keys());
  }

  private get pendingIds() {
    return this.queue.map(({id}) =>  id);
  }

  addTask<T>(_task: Task<T>, options?: { id?: string }): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = options?.id ?? `task-${this.nextId++}`;
      // 判断id是否已经存在
      if (this.running.has(id) || this.queue.some(({id: queueId}) => queueId === id)) {
        reject(new Error(`Task id ${id} already exists`));
        return;
      }
      this.queue.push({
        id,
        task: _task,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.schedule();
    })
  }

  private schedule(): void {
    while(this.runningCount < this.concurrency && this.queue.length > 0) {
        const { id, task, resolve, reject } = this.queue.shift()!;
        this.running.set(id, {
          id,
          task,
          resolve,
          reject,
        });
        task().then(resolve).catch(reject).finally(() => {
          this.running.delete(id);
          this.schedule();
        })
    }

  }

  getSnapshot():Snapshot {
    return {
      concurrency: this.concurrency,
      runningCount: this.runningCount,
      pendingCount: this.pendingCount,
      runningIds: this.runningIds,
      pendingIds: this.pendingIds,
    }
  }
}


const taskScheduler = new TaskScheduler(2);

const task1 = taskScheduler.addTask(makeTask(1000), { id: 'task-1' })
const task2 = taskScheduler.addTask(makeTask(1000), { id: 'task-2' })
const task3 = taskScheduler.addTask(makeTask(1000), { id: 'task-3' })
const task4 = taskScheduler.addTask(makeTask(1000), { id: 'task-4' })
const task5 = taskScheduler.addTask(makeTask(1000), { id: 'task-5' })

console.log('after add:',taskScheduler.getSnapshot());

Promise.all([task1, task2, task3, task4, task5]).then(() => {
  console.log('after all:',taskScheduler.getSnapshot());
});