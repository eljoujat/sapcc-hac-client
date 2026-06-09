// Find products by catalog version
// Usage: hac groovy --file find-products.groovy

def query = "SELECT {pk},{code},{name} FROM {Product} WHERE {catalogVersion} IN " +
            "( {{ SELECT {pk} FROM {CatalogVersion} WHERE {version} = 'Online' }} )"

def result = flexibleSearchService.search(query)

result.result.each { product ->
  println "PK: ${product.pk}  |  Code: ${product.code}  |  Name: ${product.name}"
}

return "Found ${result.result.size()} product(s) in Online catalog"
