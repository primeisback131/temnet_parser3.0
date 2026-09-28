package com.temnet.temnet_parser.security;

import jakarta.servlet.Filter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * A 403 from the filter chain carries a message the screen can show. Before
 * 2026-09-28 it came with an empty body, so a stale CSRF token read "no access
 * to this data" although the only fix was to reload the page.
 */
@SpringBootTest
class AccessDeniedReplyTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    @Qualifier("springSecurityFilterChain")
    private Filter securityFilter;

    @Test
    void staleCsrfTokenAsksToReloadThePage() throws Exception {
        MockMvc mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(securityFilter).build();

        mvc.perform(post("/auth/password").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("Сессия устарела, обновите страницу"));
    }

    @Test
    void missingRoleSaysSo() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        SecurityConfig.denied(new MockHttpServletRequest(), response, new AccessDeniedException("Access Denied"));

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString(UTF_8)).isEqualTo("{\"message\":\"Нет доступа к этому разделу\"}");
    }
}
