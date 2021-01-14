import { NodeEntity, Primary, String, Uuid } from "../../src/decorators";
import InternalId from "../../src/decorators/internal-id.decorator";

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