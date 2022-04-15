import { sleep } from "../utils"

/**
 * TokenBucket implements the token bucket algorithm to make it easy
 * to respect third party APIs rate limits.
 */
export class TokenBucket {
	private tokens: number
	private fillRate: number
	private capacity: number
	private lastRefill: number
	private queue: Promise<void>[] = []

	/**
	 * Creates a new TokenBucket instance.
	 * @param capacity The maximum number of tokens that can be stored in the bucket.
	 * @param fillRate The rate at which the bucket will be refilled, in tokens/seconds.
	 * @param initialTokens The number of tokens to start with, defaults to `capacity`.
	 */
	constructor(capacity: number, fillRate: number, initialTokens: number = capacity,) {
		if (capacity <= 0) {
			throw new Error("capacity must be greater than 0");
		}

		if (fillRate <= 0) {
			throw new Error("fillRate must be greater than 0");
		}

		if (initialTokens < 0 || initialTokens > capacity) {
			throw new Error("initialTokens must be between 0 and capacity inclusive");
		}

		this.capacity = capacity
		this.fillRate = fillRate
		this.tokens = initialTokens
		this.lastRefill = Date.now()
	}

	/**
	 * Refills the bucket with tokens according to the elapsed time.
	 */
	private refillBucket() {
		const now = Date.now()
		this.tokens = Math.min(this.capacity, this.tokens + this.fillRate * (now - this.lastRefill) / 1000)
		this.lastRefill = now
	}

	/**
	 * Try to consume some tokens from the bucket.
	 * @param amount The number of tokens to consume.
	 * @returns `true` if the tokens were consumed, `false` if there weren't enough tokens.
	 */ 
	private getTokens(amount: number = 1) {
		this.refillBucket()
		if (this.tokens >= amount) {
			this.tokens -= amount
			return true
		}
		return false
	}

	/**
	 * Wait for the bucket to have enough tokens to consume.
	 * Concurrent requests are stored in a queue, you can limit the queue length using
	 * the `waitForEmptyQueue()` method before waiting for more tokens in order to avoid going out of memory.
	 * @param amount The number of tokens to wait for.
	 * @returns A promise that resolves once the bucket has enough tokens.
	 */ 
	async waitForTokens(amount: number = 1) {
		if (amount > this.capacity) {
			throw new Error("amount must be less than or equal to capacity")
		}

		const promise = new Promise<void>(async resolve => {
			const previousPromise = this.queue.push(promise) - 2
			if (previousPromise >= 0) {
				await this.queue[previousPromise] // wait for the previous promise to resolve
			}
			
			while (!this.getTokens(amount)) {		
				// wait for the bucket to have enough tokens
				const neededTokens = amount - this.tokens
				const waitTime = (neededTokens / this.fillRate) * 1000
				await sleep(waitTime)
			}
			
			this.queue.shift()
			resolve()
		})

		return promise
	}

	/**
	 * Return the number of concurrent calls to `waitForTokens()`
	 */ 
	getQueueLength() {
		return this.queue.length
	}

	/**
	 * Wait for the queue to reach a certain size before continuing to call waitForTokens() .
	 * 
	 * @param interval The interval in milliseconds to use to check the queue length.
	 * @param size The expected queue size to wait for.
	 */ 
	waitForShorterQueue(interval: number = 1000, size:number = 0) {
		if(size < 0) {
			throw new Error("size must be greater than 0")
		}

		if(interval <= 0) {
			throw new Error("interval must be greater than 0")
		}

		return new Promise<void>(resolve => {
			const i = setInterval(() => {
				if (this.queue.length <= size) {
					clearInterval(i)
					resolve()
				}
			}, interval)
		})
	}

}
