import { NodeEntity, Primary, String, Uuid, InternalId } from "../../src/";


@NodeEntity()
export default class Movie {

    @InternalId()
    _id: number;

    @Uuid()
    @Primary()
    id: string;

    @String()
    title: string;

    setId(id: string) {
        this.id = id
    }

    setTitle(title: string) {
        this.title = title
    }

}