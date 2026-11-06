import { Newable } from '../meta/newable'
import { registerRepository, RepositoryConstructor } from '../meta'

/**
 * Register a custom Repository subclass for an entity (TypeORM parity):
 *
 *   @EntityRepository(Person)
 *   class PeopleRepository extends Repository<Person> { ... }
 *
 * The constructor is stored and instances are created with
 * (neode, entity, database?) when the repository is resolved.
 */
export default function EntityRepository(entity: Newable) {
  if (!entity) {
    throw new Error('@EntityRepository requires an entity class to link the repository to')
  }

  return function (repository: RepositoryConstructor) {
    registerRepository(entity, repository)
  }
}
