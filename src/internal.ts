import bodyParser from "body-parser"
import {
	Express,
	NextFunction,
	Request as ERequest,
	Response as EResponse
}                 from "express"
import morgan     from "morgan"
import {
	Database,
	open
}                 from "sqlite"
import sqlite3    from "sqlite3"

/**
 * Join multiple objects into base
 * @param base base object to assign
 * @param args objects to assign properties to base object
 */
export function joinObject<T, R extends any>(base: T, ...args: R[]): T & R {
	for (const arg of args) {
		Object.assign(base as any, arg)
	}
	return base as any
}

type XRequest = Loopback & {
	/**
	 * Get value by [key] or put a default value
	 * @param key key to value
	 * @param def default value (this will set if existing value is undefined)
	 * @param update update logic (this will run when value is present)
	 */
	data<T = any>(key: any, def?: T, update?: (val: T) => T): T
	/**
	 * Sqlite database reference (this will be null if database is not initialized)
	 */
	db: Database & XDatabase
}
type XDatabase = {
	/**
	 * Dump table to console via `console.table`
	 * @param table table name
	 * @param limit rows limit
	 * @param offset row offset
	 */
	dump_table(table: string, limit?: number, offset?: number): Promise<void>
}
type Request<P = any, B = any> = ERequest<P, any, B, B> & XRequest
export type ParamRequest<T extends Record<string, string> | undefined = undefined> = Request<T, undefined>
export type BodyRequest<T = undefined> = Request<any, T>

type Loopback = {
	/**
	 * Loopback fetch to its application
	 * @param path path to endpoint
	 * @param init
	 */
	fetch(path: string, init?: RequestInit): Promise<Response>
	/**
	 * Loopback get to its application
	 * @param path path to endpoint
	 */
	get<T = undefined>(path: string): Promise<T>
	/**
	 * Loopback post to its application
	 * @param path path to endpoint
	 * @param body object body to send
	 */
	post<T = undefined>(path: string, body: any): Promise<T>
	/**
	 * Loopback put to its application
	 * @param path path to endpoint
	 * @param body object body to send
	 */
	put<T = undefined>(path: string, body: any): Promise<T>
	/**
	 * Loopback patch to its application
	 * @param path path to endpoint
	 * @param body object body to send
	 */
	patch<T = undefined>(path: string, body: any): Promise<T>
	/**
	 * Loopback delete to its application
	 * @param path path to endpoint
	 */
	delete<T = undefined>(path: string): Promise<T>
}

type Middleware = (req: ERequest, res: EResponse, next: NextFunction) => void
type Config = {
	/**
	 * apply custom middleware like express-session
	 */
	middleware?: Middleware[]
	/**
	 * http port to listen
	 */
	port?: number
	/**
	 * data object can be assessed by `req.data(string)` function
	 */
	data?: Record<any, any>
	/**
	 * function for `req.data()`, just skip it
	 */
	data_fn?: (k: string, def?: any) => any
	/**
	 * Database configuration
	 */
	db?: {
		/**
		 * Database url
		 */
		url: string
		/**
		 * Migrations path
		 */
		migrations?: string
	}
	/**
	 * Routes for your application <br/>
	 * Example:
	 * ```
	 * routes: {
	 *   "/hello": {
	 *     get: () => "Hello"
	 *   }
	 * }
	 * ```
	 */
	routes: Record<string, RouteConfig>
}

export type RouteConfig = {
	/**
	 * This route used to handle get request
	 */
	get?: Route
	/**
	 * This route used to handle post request
	 */
	post?: Route
	/**
	 * This route used to handle put request
	 */
	put?: Route
	/**
	 * This route used to handle patch request
	 */
	patch?: Route
	/**
	 * This route used to handle delete request
	 */
	delete?: Route
}

type Route<T = any> = (req: Request<T>, res: EResponse) => any | Promise<any>

function apply_route(cfg: Config, route: Route) {
	return async function (req: any, res: any) {
		req.data = cfg.data_fn
		loopback(req)
		try {
			const resp = await route(req, res)
			typeof resp !== "undefined" && res[typeof resp == 'string' ? "end" : "json"](resp)
		} catch (e) {
			console.error(e)
			res.status(500)
			res.send("Error! " + e)
		}
	}
}

/**
 * Apply configuration and start express server
 */
export async function apply(app: Express, cfg: Config): Promise<ReturnType<Express["listen"]>> {
	const port = cfg.port || 8000
	{ // init block
		const data = cfg.data = cfg.data || {}
		cfg.data_fn = cfg.data_fn || function <T>(key: string, def?: T, closure?: (val: T) => T): any {
			let val = data[key]
			if (typeof val === "undefined") {
				return data[key] = def
			}
			if (closure) {
				const out = closure(val)
				if (out instanceof Promise) {
					return new Promise(async function (ok, err) {
						try {
							const val = await out
							ok(data[key] = val)
						} catch (e) {err(e?.toString())}
					})
				}
				data[key] = out
				return out
			}
			return val
		}
		Object.assign(LOOPBACK, {
			fetch(path: string, _init: RequestInit) {
				const ua = (this as any as ERequest)?.headers?.["user-agent"] || "Loopback"
				const init = _init || {}
				Object.assign(init.headers = init.headers || {}, {
					"user-agent": ua
				})
				return fetch("http://localhost:" + port + path, init)
			}
		} as Partial<Loopback>)

	}
	{ // database block
		if (cfg.db?.url) {
			app.use(await sqlite(cfg.db))
		}
	}
	{ // routing block
		app.use(morgan("combined"), bodyParser.json({inflate: true}))
		const {routes} = cfg
		for (const path in routes) {
			const route = routes[path]
			for (const _method in route) {
				const method = _method as keyof RouteConfig
				app[method](path, apply_route(cfg, route[method]!))
			}
		}
	}
	return new Promise(function (ok) {
		const server = app.listen(port, function () {
			console.log("Server started! http://localhost:" + port)
			ok(server)
		})
	})
}

function handle_body(resp: Response) {
	const typ = resp.headers.get("content-type") || ""
	if (typ.includes("application/json")) {
		return resp.json()
	} else {
		return resp.text()
	}
}

/**
 * Loopback object used to send http request back to itself without having to known host url
 */
export const LOOPBACK: Loopback = {
	fetch: (path: string, init?: RequestInit) => fetch(path, init),
	get(path) {
		return this.fetch(path).then(handle_body)
	},
	post(path, body) {
		return this.fetch(path, {
			method : "POST",
			headers: {'Content-Type': 'application/json'},
			body   : JSON.stringify(body)
		}).then(handle_body)
	},
	delete<T>(path: string): Promise<T> {
		return this.fetch(path, {method: "DELETE"})
		           .then(handle_body)
	},
	patch<T>(path: string, body: any): Promise<T> {
		return this.fetch(path, {
			method : "PATCH",
			headers: {'Content-Type': 'application/json'},
			body   : JSON.stringify(body)
		}).then(handle_body)
	},
	put<T>(path: string, body: any): Promise<T> {
		return this.fetch(path, {
			method : "PUT",
			headers: {'Content-Type': 'application/json'},
			body   : JSON.stringify(body)
		}).then(handle_body)
	},
}

function loopback(req: Request & any) {
	Object.assign(req, LOOPBACK)
}

async function sqlite({url, migrations}: NonNullable<Config["db"]>): Promise<Middleware> {
	sqlite3.verbose()
	const db = await open({
		filename: url,
		driver  : sqlite3.Database
	})
	if (migrations) {
		await db.migrate({migrationsPath: migrations})
	}
	Object.assign(db, {
		dump_table(this: Database, name: string, limit?: number, offset?: number) {
			let sql = 'SELECT * FROM ' + name
			if (offset) sql += ' OFFSET ' + offset
			if (limit) sql += ' LIMIT ' + limit
			return this.all(sql).then(it => console.table(it))
		}
	})
	return function (req, res, next) {
		Object.assign(req, {db})
		next()
	}
}