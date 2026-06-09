// Example fixtures for tests
// products.groovy
module.exports = {
  PRODUCT_QUERY: `SELECT {pk},{code},{name} FROM {Product} WHERE {catalogVersion} = (
    {{ SELECT {pk} FROM {CatalogVersion} WHERE {version} = 'Online' }}
  )`,

  LIST_BEANS_GROOVY: `
spring.beanDefinitionNames
  .findAll { it.contains('Service') }
  .sort()
  .each { println it }
return "Done"
  `.trim(),
};
