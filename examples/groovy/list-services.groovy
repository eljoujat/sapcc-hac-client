// List all Spring beans whose name contains 'Service'
spring.beanDefinitionNames
  .findAll { it.toLowerCase().contains('service') }
  .sort()
  .each { println it }

return "Listed ${spring.beanDefinitionNames.findAll { it.toLowerCase().contains('service') }.size()} service beans"
