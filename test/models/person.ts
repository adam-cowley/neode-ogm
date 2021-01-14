import { Direction } from "@neode/querybuilder";
import { NodeEntity, Uuid, String, OneToMany, OneToOne, InternalId } from "../../src";
import Movie from "./movie";
import Role from "./role";

@NodeEntity()
export default class Person {

    @InternalId()
    _id;

    @Uuid({ primary: true })
    id: string;

    @String()
    name: string;

    @OneToOne({
        type: 'DIRECTED',
        direction: Direction.OUTGOING,
        // target: () => Movie,
        eager: true,
    })
    directed: Movie

    @OneToMany(
        // @ts-ignore
        () => Movie,
        'ACTED_IN',
        Direction.OUTGOING,
        true
    )
    actedIn: Movie[] = []

    @OneToOne({
        type: 'ACTED_IN_TOP_ROLE',
        direction: Direction.OUTGOING,
        eager: true,
    })
    topRole: Role

    @OneToMany(
        // @ts-ignore
        () => Role,
        'ACTED_IN_ROLE',
        Direction.OUTGOING,
        true
    )
    roles: Role[] = []

    static create(id: string, name: string): Person {
        const person = new Person()

        person.id = id
        person.name = name

        return person
    }

    getId() {
        return this.id
    }

    getName() {
        return this.name
    }

    setDirected(movie: Movie) {
        this.directed = movie
    }

    getDirected() {
        return this.directed
    }

    addActedIn(movie: Movie) {
        this.actedIn.push(movie)
    }

    getMovies() {
        return this.actedIn
    }

    setTopRole(role: Role) {
        this.topRole = role
    }

    addRole(role: Role) {
        this.roles.push(role)
    }

    getRoles() {
        return this.roles
    }

}