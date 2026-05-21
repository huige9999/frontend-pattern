import { resolve } from "path";

type Options = {
  concurrency: number;
};

type Task = () => Promise<number>;
type InterTask = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  task: Task;
};

export class TaskScheduler {
  private concurrency: number;
  private queue: InterTask[] = [];
  private running: number = 0;
  private paused:boolean = false;

  constructor(options: Options) {
    this.concurrency = options.concurrency;
  }

  async addTask(fn: Task) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task: fn,
        resolve,
        reject,
      });
      this.schedule();
    });
  }

  schedule() {
    if(this.paused) {
        return;
    }
    while (this.queue.length > 0 && this.running < this.concurrency) {
      const currenTask = this.queue.shift();
      currenTask!
        .task()
        .then(currenTask!.resolve)
        .catch(currenTask!.reject)
        .finally(() => {
          this.running--;
          this.schedule();
        });
      this.running++;
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.schedule();
  }
}
