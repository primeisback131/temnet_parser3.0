package com.temnet.temnet_parser.controller;

import com.temnet.temnet_parser.dto.Grant;
import com.temnet.temnet_parser.dto.HelpAccountScope;
import com.temnet.temnet_parser.dto.UserAccount;
import com.temnet.temnet_parser.security.AccessControlService;
import com.temnet.temnet_parser.service.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Account management. The whole /admin/** tree is administrators only. */
@RestController
@RequestMapping("/admin/users")
public class UserAdminController {

    public record CreateRequest(String username, String password, String fullName, String role,
                                Boolean enabled, List<Grant> grants) {
    }

    public record UpdateRequest(String fullName, String role, Boolean enabled, List<Grant> grants) {
    }

    public record PasswordRequest(String password) {
    }

    private final UserService userService;
    private final AccessControlService accessControl;

    public UserAdminController(UserService userService, AccessControlService accessControl) {
        this.userService = userService;
        this.accessControl = accessControl;
    }

    @GetMapping
    public List<UserAccount> list() {
        return userService.list();
    }

    /** Help accounts available for granting, each with the groups it covers. */
    @GetMapping("/help-accounts")
    public List<HelpAccountScope> helpAccounts() {
        return userService.allHelpAccounts();
    }

    @PostMapping
    public long create(@RequestBody CreateRequest body) {
        return userService.create(body.username(), body.password(), body.fullName(), body.role(),
                body.enabled() == null || body.enabled(),
                body.grants() == null ? List.of() : body.grants());
    }

    @PutMapping("/{id}")
    public void update(@PathVariable long id, @RequestBody UpdateRequest body) {
        userService.update(id, body.fullName(), body.role(),
                body.enabled() == null || body.enabled(),
                body.grants() == null ? List.of() : body.grants());
    }

    @PutMapping("/{id}/password")
    public void changePassword(@PathVariable long id, @RequestBody PasswordRequest body) {
        userService.changePassword(id, body.password());
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        userService.delete(id, accessControl.currentUser().id());
    }

    /**
     * Validation and guard failures are the caller's mistake, not a server
     * fault: answer 400 with the reason in the problem body so the UI can
     * show it instead of a bare status code.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail rejected(IllegalArgumentException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }
}
