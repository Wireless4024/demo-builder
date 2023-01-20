import express from "express"
import {
	apply,
	BodyRequest
}              from "./internal"

const app = express()

apply(app, {
	routes: {
		"/hello": {
			// GET '/hello' endpoint returning "Hello"
			get: () => "Hello"
		},
		"/world": {
			// this route will get output from '/hello' declared above and concat with ` world!`
			get: async (req) => (await req.get<string>("/hello")) + " world!"
		},
		"/db"   : {
			async get(req) {
				req.db.dump_table("Hello").then()
				return req.db.all("SELECT * FROM Hello")
			},
			// this will insert `world` in request body into db
			post(req: BodyRequest<{ world: string }>) {
				return req.db.run("INSERT INTO Hello(world) VALUES (?) RETURNING ROWID", req.body?.world || "world")
			}
		}
	},
	// port to listen
	port: 8000,
	// sqlite configuration
	db: {
		// database path, `:memory:` for in-memory database
		url: "./db.sqlite",
		// migration folder
		migrations: "src/migrations"
	}
}).then()