import { NodeEntity, Primary, String, Uuid } from "../../src/decorators";

@NodeEntity()
export default class Movie {

    @Uuid()
    @Primary()
    id: string;

    @String()
    title: string;

}