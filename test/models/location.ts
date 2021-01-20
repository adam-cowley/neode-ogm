import { NodeEntity, Uuid, String } from "../../src";

@NodeEntity()
export default class Location {

    @Uuid({ primary: true })
    id: string;

    @String({ unique: true })
    name: string;

    static create(name: string): Location {
        const location = new Location;

        location.setName(name)

        return location
    }

    setName(name: string) {
        this.name = name
    }

}