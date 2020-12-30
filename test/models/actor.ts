import { Node, Primary, Unique, Uuid, String } from "../../src/decorators";
import Person from "./person";

@Node({ labels: ['Person', 'Actor'] })
export default class Actor extends Person {


}