import { Node, Primary, Unique, Uuid, String } from "../../src/decorators";

@Node({ labels: ['Person', 'Actor'] })
export default class Person {
    @Uuid()
    @Primary()
    @Unique()
    id: string;

    @String()
    name: string;

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

}