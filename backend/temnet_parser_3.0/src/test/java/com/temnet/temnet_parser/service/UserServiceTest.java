package com.temnet.temnet_parser.service;

import com.temnet.temnet_parser.dto.UserAccount;
import com.temnet.temnet_parser.repository.UserRepository;
import com.temnet.temnet_parser.security.AppPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The account table must always keep at least one active administrator. */
class UserServiceTest {

    private static final long ADMIN = 1;
    private static final long OTHER_ADMIN = 2;
    private static final long MANAGER = 3;

    private UserRepository repository;
    private UserService service;

    @BeforeEach
    void setUp() {
        repository = mock(UserRepository.class);
        service = new UserService(repository, mock(PasswordEncoder.class), "");
        when(repository.findPrincipalById(ADMIN)).thenReturn(Optional.of(principal(ADMIN, "admin", true)));
        when(repository.findPrincipalById(MANAGER)).thenReturn(Optional.of(principal(MANAGER, "manager", true)));
    }

    @Test
    void refusesToDeleteTheLastAdministrator() {
        when(repository.countEnabledAdminsExcluding(ADMIN)).thenReturn(0L);

        var e = assertThrows(IllegalArgumentException.class, () -> service.delete(ADMIN, OTHER_ADMIN));

        assertEquals("Нельзя лишить прав последнего администратора", e.getMessage());
        verify(repository, never()).delete(anyLong());
    }

    @Test
    void deletesAnAdministratorWhenAnotherRemains() {
        when(repository.countEnabledAdminsExcluding(ADMIN)).thenReturn(1L);

        service.delete(ADMIN, OTHER_ADMIN);

        verify(repository).delete(ADMIN);
    }

    @Test
    void deletesManagersWithoutCountingAdministrators() {
        service.delete(MANAGER, ADMIN);

        verify(repository).delete(MANAGER);
        verify(repository, never()).countEnabledAdminsExcluding(anyLong());
    }

    @Test
    void refusesToDeleteYourself() {
        assertThrows(IllegalArgumentException.class, () -> service.delete(ADMIN, ADMIN));

        verify(repository, never()).delete(anyLong());
    }

    @Test
    void refusesToDemoteOrDisableTheLastAdministrator() {
        when(repository.countEnabledAdminsExcluding(ADMIN)).thenReturn(0L);

        assertThrows(IllegalArgumentException.class,
                () -> service.update(ADMIN, "Admin", UserAccount.ROLE_MANAGER, true, List.of()));
        assertThrows(IllegalArgumentException.class,
                () -> service.update(ADMIN, "Admin", UserAccount.ROLE_ADMIN, false, List.of()));

        verify(repository, never()).updateProfile(anyLong(), any(), any(), anyBoolean());
    }

    @Test
    void updatesTheLastAdministratorWhileItStaysAnAdministrator() {
        when(repository.countEnabledAdminsExcluding(ADMIN)).thenReturn(0L);

        service.update(ADMIN, "Renamed", UserAccount.ROLE_ADMIN, true, List.of());

        verify(repository).updateProfile(ADMIN, "Renamed", UserAccount.ROLE_ADMIN, true);
    }

    private static AppPrincipal principal(long id, String role, boolean enabled) {
        return new AppPrincipal(id, "user" + id, "User " + id, "hash", role, enabled, false);
    }
}
