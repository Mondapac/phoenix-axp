package org.phoenix.flowable;

import java.util.HashMap;
import org.flowable.cmmn.spring.SpringCmmnEngineConfiguration;
import org.flowable.dmn.spring.SpringDmnEngineConfiguration;
import org.flowable.spring.SpringProcessEngineConfiguration;
import org.flowable.spring.boot.EngineConfigurationConfigurer;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * Expressions resolve no Spring bean (security review of Phoenix slice 2.2). Left unset, each
 * engine's {@code beans} map is a proxy over the whole application context, so an expression in a
 * model could call a method of any bean of the engine's process. An empty map leaves process
 * variables and literals only. The core's BPMN guard already refuses member access and calls;
 * this is the engine's own backstop for the same rule. Applied before each engine is built.
 */
@AutoConfiguration
public class NoExpressionBeansAutoConfiguration {

  @Bean
  public EngineConfigurationConfigurer<SpringProcessEngineConfiguration> phoenixProcessNoBeans() {
    return configuration -> configuration.setBeans(new HashMap<>());
  }

  @Bean
  public EngineConfigurationConfigurer<SpringCmmnEngineConfiguration> phoenixCmmnNoBeans() {
    return configuration -> configuration.setBeans(new HashMap<>());
  }

  @Bean
  public EngineConfigurationConfigurer<SpringDmnEngineConfiguration> phoenixDmnNoBeans() {
    return configuration -> configuration.setBeans(new HashMap<>());
  }
}
