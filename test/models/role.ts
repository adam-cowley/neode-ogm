import { EndNode, RelationshipEntity, String, InternalId } from "../../src/";
import Movie from "./movie";

@RelationshipEntity()
export default class Role {

    @InternalId()
    internalId?: Number;

    // TODO: Due to circular dependencies, Person is undefined???
    // Maybe just calling the get entity function outside of the Decorator will do?

    // @StartNode(() => Person)
    // actor?: Person;

    // @ts-ignore
    @EndNode(() => Movie)
    movie: Movie;

    @String({
        array: true
    })
    roles: string[] = [];

    setMovie(movie: Movie) {
        this.movie = movie
    }

    addRole(role: string) {
        this.roles.push(role)
    }
}
