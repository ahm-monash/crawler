import { captureRejectionSymbol } from "events";
import { TokenBucket } from "./rate-limiting/token-bucket";
import { getPackageManifest } from "query-registry";
//import { fetch } from "node-fetch";

export const APIParameters = {
	// Github api allows 5000 reqs per hour. 5000/3600 = 1.388 reqs per second.
	npm: {
		// Some sources suggest npm allows up to 5 million requests per month.
		rateLimit: 5000000 / (3600 * 24 * 30),
		intialTokens: 250,
	},
	pypi: {
		// PyPI has no set rate limit, but says to "[t]ry not to make a lot of requests (thousands) in a short amount
		// of time (minutes)", and "it’s preferred to make requests in serial over a longer amount of time if
		// possible", so we'll keep it at 1000 a minute for now.
		rateLimit: 1000 / 60,
		intialTokens: 1
	},
	rubygems: {
		// https://guides.rubygems.org/rubygems-org-rate-limits/
		// 15 per second for the dependency API
		rateLimit: 15,
		intialTokens: 1
	},
}

	//https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-the-dependency-graph
export const packageManagerFiles = [
	{ name: "NPM", extensions: ["package.json"] },
	{ name: "PYPI", extensions: ["requirements.txt"] },
	{ name: "RUBYGEMS", extensions: ["Gemfile", ".gemspec"] },
]

//Ratelimiter is a POJO that contains a TokenBuckets and RequestCounters for each API source.
export type PackageRateLimiter = {
	npm: {
		tokenBucket: TokenBucket;
		//reqCounter: RequestCounter;
	},
	pypi: {
		tokenBucket: TokenBucket;
	},
	rubygems: {
		tokenBucket: TokenBucket;
	},
}

export type Repository = {
	name: string,
	oldName: string,
	version: string,
	link: string,
	isArchived: boolean,
	dependencies: Map<string, string>
}

//Gets the information for a single npm dependecy from the external service.
export async function queryDependencyNpm(dependency: string, rateLimiter: PackageRateLimiter) {
	await rateLimiter.npm.tokenBucket.waitForTokens(1)

	let manifest
	try{
		manifest = await getPackageManifest({ name: dependency })
	}
	catch(e){
		manifest = { version: "1.0.0"}
		console.log(e)
	}
	return { name: dependency, data: { version: manifest.version } }
}

type PythonPackageVersion = {
	epoch: number,
	first: number,
	rest: number[],
	isPrerelease: boolean,
}

export function parsePythonPackageVersion(versionString: string): PythonPackageVersion {
	//https://peps.python.org/pep-0440/
	//[N!]N(.N)*[{a|b|rc}N][.postN][.devN]
	//Not a complete implementation, just enough for us to get the most recent useable version
	//c instead of rc is not accepted

	let version: PythonPackageVersion = { epoch: 0, first: 0, rest: [], isPrerelease: false }

	//Parse the epoch is present
	const epochPart = versionString.split("!", 2)
	if (epochPart.length == 2) {
		version.epoch = parseInt(epochPart[0])
		versionString = versionString[1]
	}

	const parts = versionString.split(".")

	//A major version number is always present
	version.first = parseInt(parts[0])

	//Parse rest version
	for (let part of parts.slice(1)) {
		const alpha = part.split("a", 2)
		const beta = part.split("b", 2)
		const releaseCandidate = part.split("rc", 2)

		//Parse post or dev version if present, then check for alpha/beta/release candidate
		if (part.substring(0, 3) === "dev") {
			part = part.substring(3)
			version.isPrerelease = true
		} else if (part.substring(0, 4) === "post") {
			part = part.substring(4)
		} else if (alpha.length == 2) {
			version.isPrerelease = true
			part = alpha[0]
		} else if (beta.length == 2) {
			version.isPrerelease = true
			part = beta[0]
		} else if (releaseCandidate.length == 2) {
			version.isPrerelease = true
			part = releaseCandidate[0]
		}

		version.rest.push(parseInt(part))
	}

	return version
}

export function greaterThanPythonPackageVersion(a: PythonPackageVersion, b: PythonPackageVersion): boolean {
	if (a.isPrerelease && !b.isPrerelease) { return false; }
	else if (!a.isPrerelease && b.isPrerelease) { return true; }
	else if (a.first > b.first) { return true; }
	else {
		let isEqual: boolean = true;
		for (let i = 0; i < a.rest.length && i < b.rest.length && isEqual; i++) {
			if (a.rest[i] != b.rest[i]) { return a.rest[i] > b.rest[i] }
		}

		return a.rest.length > b.rest.length
	}
}

//Gets the information for a single pip dependecy from an external service, PyPI.
export async function queryDependencyPyPI(dependency: string, rateLimiter: PackageRateLimiter) {
	await rateLimiter.pypi.tokenBucket.waitForTokens(1)

	//https://warehouse.pypa.io/api-reference/, they suggest that our user agent should mention who we are
	const response = await (await fetch("https://pypi.org/pypi/" + dependency + "/json")).json()
	const data = response as { info: { version : any}, releases : any }

	let bestVersion: string = "0"
	let bestVersionObject: PythonPackageVersion = {epoch: 0, first: 0, rest: [], isPrerelease: true}

	//We have to look through all releases to find the most recent, non-pre-release version
	for (const release in data.releases) {
		const version = parsePythonPackageVersion(release)

		if(greaterThanPythonPackageVersion(version, bestVersionObject)){
			bestVersionObject = version
			bestVersion = release
		}
	}

	return { name: dependency, data: { version: bestVersion } }
}

//Gets the information for a single Ruby dependecy from an external service, RubyGems.
export async function queryDependencyRubyGems(dependency: string, rateLimiter: PackageRateLimiter) {
	await rateLimiter.rubygems.tokenBucket.waitForTokens(1)

	//https://guides.rubygems.org/rubygems-org-api/
	const response = await (await fetch("https://rubygems.org/api/v1/versions/" + dependency + "/latest.json")).json()
	const data = response as { version: string }

	return { name: dependency, data: { version: data.version } }
}

//Calls the given API for all dependencies in the given list
async function getDependencies(dependencies: string[], rateLimiter: PackageRateLimiter, queryFunc: any) {
		let depMap: Map<string, { version: string }> = new Map()

		const depList = await Promise.all(
			dependencies.map((dependency) => queryFunc(dependency, rateLimiter))
		);

		for (const dependency of depList) {
			depMap.set(dependency.name, dependency.data)
		}

		return depMap
	}

//Calls the npm API for all dependencies in the given list
export async function getDependenciesNpm(dependencies: string[], rateLimiter: PackageRateLimiter) {
	return getDependencies(dependencies, rateLimiter, queryDependencyNpm)
}

//Calls the PyPI API for all dependencies in the given list
export async function getDependenciesPyPI(dependencies: string[], rateLimiter: PackageRateLimiter) {
	return getDependencies(dependencies, rateLimiter, queryDependencyPyPI)
}

//Calls the RubyGems API for all dependencies in the given list
export async function getDependenciesRubyGems(dependencies: string[], rateLimiter: PackageRateLimiter) {
	return getDependencies(dependencies, rateLimiter, queryDependencyRubyGems)
}



// export async function getNPMMetadata(packageJSON:type) {

// }
