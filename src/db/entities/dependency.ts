
/**
 * DependencyType tells wether a dependency is a dev dependency or not
 */
export const enum DependencyType {
	Production = "prod",
	Development = "dev"
}

/**
 * A dependency is a link between two packages.
 * The master depends on the slave.
 */
export interface Dependency {
	id : number;
	masterId : number;
	slaveId : number;
	usedVersion : string;
	type: DependencyType;
}