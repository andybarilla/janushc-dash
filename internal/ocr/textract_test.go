package ocr

import (
	"errors"
	"testing"

	"github.com/aws/smithy-go"
)

func TestIsAccessDenied(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"plain error", errors.New("network down"), false},
		{"access denied", &smithy.GenericAPIError{Code: "AccessDeniedException"}, true},
		{"unauthorized", &smithy.GenericAPIError{Code: "UnauthorizedException"}, true},
		{"invalid job id means perms present", &smithy.GenericAPIError{Code: "InvalidJobIdException"}, false},
		{"invalid parameter means perms present", &smithy.GenericAPIError{Code: "InvalidParameterException"}, false},
	}
	for _, tc := range cases {
		if got := isAccessDenied(tc.err); got != tc.want {
			t.Errorf("%s: isAccessDenied = %v, want %v", tc.name, got, tc.want)
		}
	}
}
