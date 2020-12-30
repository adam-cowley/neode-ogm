import Repository from "../../src/repository";
import { Repository as RepositoryDecorator } from "../../src/decorators"
import Person from "../models/person";

@RepositoryDecorator(Person)
export default class PersonRepository extends Repository<Person> {}